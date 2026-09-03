[CLOSED]

# Debug Session: wrong-server-501

- Status: [CLOSED]
- Goal: 定位访问 127.0.0.1:8765 返回 Unsupported method GET 的原因。
- Constraint: 先只检查运行时进程与端口，不修改业务代码。

## Hypotheses

1. 8765 被遗留的模拟 HTTP 服务占用。
2. 正式项目因端口占用没有成功启动。
3. 浏览器当前访问的是模拟服务而不是 FastAPI。
4. 停止错误进程并重新启动项目后可恢复。

## Evidence

- 8765 原监听进程 PID 5640 的命令行为本地 401 模拟服务，只实现了 POST。
- 访问首页返回 Python `BaseHTTPRequestHandler` 的 HTTP 501，而不是 FastAPI。
- 停止模拟服务并重启项目后，首页返回 HTTP 200，Server 为 `uvicorn`，HTML 包含应用标题。

## Conclusion

根因是上一次模型错误测试遗留的模拟服务占用了 8765，导致正式项目未能绑定该端口。当前正式项目已重新启动并保持运行。

## Post-fix Verification

- 正式服务进程仍在运行，命令行为 `python -X utf8 -m app.main --no-browser`。
- 8765 由正式项目监听。
- 连续 3 次请求首页均返回 HTTP 200、Server `uvicorn`、响应长度 28136 字节。
- Trae Preview 的 `net::ERR_ABORTED` 是预览导航被取消的客户端记录，不是当前服务端请求失败。
