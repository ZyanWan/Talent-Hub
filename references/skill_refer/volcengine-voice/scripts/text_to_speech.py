#!/usr/bin/env python3
"""
火山引擎 TTS API - 单向流式语音合成
使用官方推荐的 WebSocket API，时延更优
"""
import argparse
import json
import logging
import struct
import uuid
import os
from pathlib import Path
import sys
from enum import IntEnum
from typing import List, Callable, Optional
import io

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== 协议定义 ====================

class MsgType(IntEnum):
    """消息类型"""
    FullClientRequest = 0b0001
    FullServerResponse = 0b1001
    AudioOnlyServer = 0b1011
    Error = 0b1111


class MsgTypeFlagBits(IntEnum):
    """消息类型标志位"""
    NoEvent = 0b0000
    WithEvent = 0b0100


class SerializationBits(IntEnum):
    """序列化方法"""
    Raw = 0b0000
    JSON = 0b0001


class CompressionBits(IntEnum):
    """压缩方法"""
    None_ = 0b0000
    Gzip = 0b0001


class EventType(IntEnum):
    """事件类型"""
    FinishConnection = 2
    ConnectionFinished = 52
    SessionFinished = 152
    TTSSentenceStart = 350
    TTSSentenceEnd = 351
    TTSResponse = 352


# ==================== 协议实现 ====================

def build_message(payload: bytes, msg_type: MsgType = MsgType.FullClientRequest, 
                  flag: MsgTypeFlagBits = MsgTypeFlagBits.NoEvent,
                  serialization: SerializationBits = SerializationBits.JSON) -> bytes:
    """构建协议消息"""
    buffer = io.BytesIO()
    
    # Header (4 bytes)
    header = [
        (1 << 4) | 1,  # Protocol version (v1) + Header size (4 bytes)
        (msg_type << 4) | flag,
        (serialization << 4) | CompressionBits.None_,
        0  # Reserved
    ]
    buffer.write(bytes(header))
    
    # Payload size (4 bytes, big-endian)
    payload_size = len(payload)
    buffer.write(struct.pack(">I", payload_size))
    
    # Payload
    buffer.write(payload)
    
    return buffer.getvalue()


def parse_response(data: bytes) -> dict:
    """解析协议响应"""
    if len(data) < 8:
        raise ValueError(f"Data too short: {len(data)} bytes")
    
    # Parse header
    msg_type = MsgType((data[1] >> 4) & 0x0F)
    flag = MsgTypeFlagBits(data[1] & 0x0F)
    serialization = SerializationBits((data[2] >> 4) & 0x0F)
    
    result = {
        "msg_type": msg_type,
        "flag": flag,
        "serialization": serialization,
    }
    
    # Parse optional event field (if flag == WithEvent)
    offset = 4
    if flag == MsgTypeFlagBits.WithEvent:
        event = EventType(struct.unpack(">I", data[offset:offset+4])[0])
        result["event"] = event
        offset += 4
    
    # Parse payload size
    payload_size = struct.unpack(">I", data[offset:offset+4])[0]
    offset += 4
    
    # Parse payload
    payload = data[offset:offset+payload_size]
    result["payload"] = payload
    
    # Parse JSON payload if applicable
    if serialization == SerializationBits.JSON and payload:
        try:
            result["json"] = json.loads(payload.decode("utf-8"))
        except:
            pass
    
    return result


# ==================== TTS 客户端 ====================

class VolcEngineTTS:
    """火山引擎 TTS API 客户端"""
    
    def __init__(self, api_key=None, resource_id="seed-tts-1.0"):
        """
        初始化 TTS 客户端
        
        Args:
            api_key: 火山引擎 API Key（新版控制台）
            resource_id: 模型版本（seed-tts-1.0 或 seed-tts-2.0）
        """
        self.api_key = api_key or os.getenv("VOLCENGINE_API_KEY")
        self.resource_id = resource_id or os.getenv("VOLC_RESOURCE_ID", "seed-tts-1.0")
        
        if not self.api_key:
            raise ValueError("请设置 VOLCENGINE_API_KEY 环境变量")
    
    async def synthesize(self, text, output_file="output.wav", speaker="BV700_V2_streaming",
                       format="wav", sample_rate=24000, 
                       endpoint="wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream"):
        """
        合成语音
        
        Args:
            text: 要合成的文本
            output_file: 输出文件路径
            speaker: 音色ID
            format: 音频格式 (wav/mp3/ogg_opus/pcm)
            sample_rate: 采样率
            endpoint: API 端点
        """
        import websockets
        
        # 构建请求头（新版控制台认证方式）
        headers = {
            "X-Api-Key": self.api_key,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
        }
        
        logger.info(f"Connecting to {endpoint}")
        logger.info(f"Using API Key: {self.api_key[:8]}...")
        logger.info(f"Resource ID: {self.resource_id}")
        
        websocket = await websockets.connect(
            endpoint, 
            additional_headers=headers, 
            max_size=10 * 1024 * 1024
        )
        
        # 获取响应头中的 logid
        logid = websocket.response.headers.get('x-tt-logid', '')
        logger.info(f"Connected, Logid: {logid}")
        
        try:
            # 构建请求 payload
            request_payload = {
                "user": {
                    "uid": str(uuid.uuid4())
                },
                "req_params": {
                    "text": text,
                    "speaker": speaker,
                    "audio_params": {
                        "format": format,
                        "sample_rate": sample_rate
                    }
                }
            }
            
            payload_bytes = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
            message = build_message(payload_bytes)
            
            logger.info(f"Sending request: {request_payload}")
            await websocket.send(message)
            
            # 接收音频数据
            audio_data = bytearray()
            session_id = None
            
            while True:
                data = await websocket.recv()
                if isinstance(data, str):
                    logger.warning(f"Received text message: {data}")
                    continue
                
                response = parse_response(data)
                msg_type = response.get("msg_type")
                event = response.get("event")
                
                logger.debug(f"Received: msg_type={msg_type}, event={event}")
                
                if msg_type == MsgType.AudioOnlyServer:
                    # 音频数据
                    audio_data.extend(response["payload"])
                    
                elif msg_type == MsgType.FullServerResponse:
                    # JSON 响应
                    if event == EventType.TTSSentenceStart:
                        json_data = response.get("json", {})
                        session_id = json_data.get("session_id")
                        logger.info(f"Session started: {session_id}")
                        
                    elif event == EventType.SessionFinished:
                        logger.info("Session finished")
                        break
                        
                    elif event == EventType.ConnectionFinished:
                        logger.info("Connection finished")
                        break
                        
                elif msg_type == MsgType.Error:
                    error_json = response.get("json", {})
                    raise RuntimeError(f"TTS error: {error_json}")
            
            if not audio_data:
                raise RuntimeError("No audio data received")
            
            # 保存音频文件
            Path(output_file).parent.mkdir(parents=True, exist_ok=True)
            with open(output_file, "wb") as f:
                f.write(audio_data)
            
            logger.info(f"Audio saved to {output_file} ({len(audio_data)} bytes)")
            return True, f"音频已保存到 {output_file}"
            
        finally:
            await websocket.close()
            logger.info("Connection closed")


def main():
    """命令行入口"""
    import asyncio
    
    parser = argparse.ArgumentParser(description="火山引擎 TTS API")
    parser.add_argument("--api_key", help="API Key (也可通过环境变量 VOLCENGINE_API_KEY 设置)")
    parser.add_argument("--resource_id", default="seed-tts-1.0", 
                       help="Resource ID (默认: seed-tts-1.0)")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--speaker", default="BV700_V2_streaming", help="音色ID")
    parser.add_argument("--format", default="wav", help="音频格式 (wav/mp3/ogg_opus/pcm)")
    parser.add_argument("--sample_rate", type=int, default=24000, help="采样率")
    parser.add_argument("-o", "--output", default="output.wav", help="输出文件路径")
    parser.add_argument("--endpoint", 
                       default="wss://openspeech.bytedance.com/api/v3/tts/unidirectional/stream",
                       help="API 端点")
    
    args = parser.parse_args()
    
    try:
        tts = VolcEngineTTS(
            api_key=args.api_key,
            resource_id=args.resource_id
        )
        
        success, message = asyncio.run(tts.synthesize(
            text=args.text,
            output_file=args.output,
            speaker=args.speaker,
            format=args.format,
            sample_rate=args.sample_rate,
            endpoint=args.endpoint
        ))
        
        print(message)
        return 0 if success else 1
        
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())