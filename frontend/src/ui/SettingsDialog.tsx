// =====================================================================
// 设置弹窗（React）：编辑类弹窗。
// - 编辑类弹窗：仅「关闭按钮 + ESC」退出，点遮罩不关闭（防止误触丢未保存输入）
// - 密钥语义：api_key / asr_api_key / feishu_sign_secret 打开弹窗时恒为空
//   （不回填明文密钥）；留空提交空串表示保留已存值（服务端仅覆盖非空字段）；
//   「清除 ASR」「清除飞书签名」置 clear_asr / clear_feishu_sign=true 并提交
//   表单，对应密钥字段同时提交空串
// - 保存 PUT /api/settings，成功后写回全局 state.settings（settings 模块自持
//   字段）；测试模型连接 POST /api/settings/test（zh 优先展示服务端返回的
//   result.message，en 固定通用文案）；测试飞书 POST /api/settings/feishu-test
// - 请求负载键名/端点固定；结果提示区
//   .dialog-message（error 追加 .error）；语言切换经 i18n onChange 重渲染
//   并清空结果提示
// =====================================================================

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { getLanguage, onChange, t } from "../i18n";
import { state } from "../state";
import { Button } from "./Button";
import { useDialogAnimation } from "./useDialogAnimation";

export interface SettingsDialogProps {
    open: boolean;
    onClose: () => void;
}

interface SettingsForm {
    base_url: string;
    api_key: string;
    asr_api_key: string;
    model: string;
    max_parallel: string;
    request_timeout: string;
    ocr_executable: string;
    retain_resume_text: boolean;
    call_qa_records: boolean;
    feishu_push_enabled: boolean;
    feishu_webhook_url: string;
    feishu_sign_secret: string;
}

interface SettingsMessage {
    text: string;
    error: boolean;
}

function asString(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** 打开弹窗时的表单初值：密钥字段恒为空，其余字段回填已存配置 */
function initialForm(): SettingsForm {
    const settings = state.settings;
    return {
        base_url: asString(settings?.base_url) || "https://api.openai.com/v1",
        api_key: "",
        asr_api_key: "",
        model: asString(settings?.model),
        max_parallel: String(settings?.max_parallel || 6),
        request_timeout: String(settings?.request_timeout || 180),
        ocr_executable: asString(settings?.ocr_executable),
        retain_resume_text: settings?.retain_resume_text !== false,
        call_qa_records: settings?.call_qa_records === true,
        feishu_push_enabled: settings?.feishu_push_enabled === true,
        feishu_webhook_url: asString(settings?.feishu_webhook_url),
        feishu_sign_secret: "",
    };
}

/** 提交负载：clear_* 为真时对应密钥字段提交空串 */
function buildPayload(form: SettingsForm, clearAsr: boolean, clearFeishuSign: boolean) {
    return {
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        asr_api_key: clearAsr ? "" : form.asr_api_key.trim(),
        clear_asr: clearAsr,
        model: form.model.trim(),
        max_parallel: Number(form.max_parallel),
        request_timeout: Number(form.request_timeout),
        ocr_executable: form.ocr_executable.trim(),
        retain_resume_text: form.retain_resume_text,
        call_qa_records: form.call_qa_records,
        feishu_push_enabled: form.feishu_push_enabled,
        feishu_webhook_url: form.feishu_webhook_url.trim(),
        feishu_sign_secret: clearFeishuSign ? "" : form.feishu_sign_secret.trim(),
        clear_feishu_sign: clearFeishuSign,
    };
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
    const [form, setForm] = useState<SettingsForm>(initialForm);
    // clear_* 标志为一次性瞬态：清除按钮置位后由下一次提交消费并复位；用 ref 持有
    // 保证与 requestSubmit 的同步提交流程（先清字段再提交）不产生异步竞态
    const clearAsrRef = useRef(false);
    const clearFeishuSignRef = useRef(false);
    const formRef = useRef<HTMLFormElement>(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testingFeishu, setTestingFeishu] = useState(false);
    const [message, setMessage] = useState<SettingsMessage | null>(null);
    const [, forceRender] = useState(0);

    // 语言切换时重渲染（按钮/OCR 状态文案随语言变化），并清空结果提示
    useEffect(() => {
        let active = true;
        onChange(() => {
            if (!active) return;
            forceRender((n) => n + 1);
            setMessage(null);
        });
        return () => {
            active = false;
        };
    }, []);

    // 每次打开时按已存配置初始化表单并清空结果提示（密钥输入框恒为空）
    useEffect(() => {
        if (!open) return;
        setForm(initialForm());
        setMessage(null);
    }, [open]);

    // ESC 关闭（编辑类弹窗：仅关闭按钮 + ESC，点遮罩不关闭）
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    // 开合动画：挂载后置 .is-visible 播放过渡，关闭时播完离场动画再卸载
    const { mounted, visible } = useDialogAnimation(open, 300);

    if (!mounted) return null;

    const setField = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const consumeClearFlags = (): { clearAsr: boolean; clearFeishuSign: boolean } => {
        const clearAsr = clearAsrRef.current;
        const clearFeishuSign = clearFeishuSignRef.current;
        clearAsrRef.current = false;
        clearFeishuSignRef.current = false;
        return { clearAsr, clearFeishuSign };
    };

    const handleSave = async (event: FormEvent) => {
        event.preventDefault();
        const { clearAsr, clearFeishuSign } = consumeClearFlags();
        setSaving(true);
        try {
            state.settings = await api<Record<string, unknown>>("/api/settings", {
                method: "PUT",
                body: JSON.stringify(buildPayload(form, clearAsr, clearFeishuSign)),
            });
            setMessage({ text: t("settingsSaved"), error: false });
        } catch (error) {
            setMessage({ text: (error as Error).message, error: true });
        } finally {
            setSaving(false);
        }
    };

    const handleTestSettings = async () => {
        const { clearAsr, clearFeishuSign } = consumeClearFlags();
        setTesting(true);
        try {
            const result = await api<{ message?: string }>("/api/settings/test", {
                method: "POST",
                body: JSON.stringify(buildPayload(form, clearAsr, clearFeishuSign)),
            });
            setMessage({
                text: getLanguage() === "en" ? t("connectionTestPassed") : result.message || t("connectionTestPassed"),
                error: false,
            });
        } catch (error) {
            setMessage({ text: (error as Error).message, error: true });
        } finally {
            setTesting(false);
        }
    };

    const handleTestFeishu = async () => {
        const { clearAsr, clearFeishuSign } = consumeClearFlags();
        setTestingFeishu(true);
        try {
            await api("/api/settings/feishu-test", {
                method: "POST",
                body: JSON.stringify(buildPayload(form, clearAsr, clearFeishuSign)),
            });
            setMessage({ text: t("feishuTestPassed"), error: false });
        } catch (error) {
            setMessage({ text: t("feishuTestFailed", { message: (error as Error).message }), error: true });
        } finally {
            setTestingFeishu(false);
        }
    };

    // 清除按钮：清空输入框、置位 clear_* 标志并直接提交表单（requestSubmit 走原生表单校验）
    const handleClearAsr = () => {
        clearAsrRef.current = true;
        setField("asr_api_key", "");
        formRef.current?.requestSubmit();
    };

    const handleClearFeishuSign = () => {
        clearFeishuSignRef.current = true;
        setField("feishu_sign_secret", "");
        formRef.current?.requestSubmit();
    };

    // OCR 状态（ready/error 样式类 + 语言化文案）
    const ocr = state.settings?.ocr as { ready?: boolean; languages?: string[]; message?: string } | undefined;
    let ocrText = t("ocrMissing");
    let ocrClass: string | undefined;
    if (ocr?.ready) {
        const languageNames: Record<string, string> = {
            chi_sim: getLanguage() === "en" ? "Simplified Chinese" : "简体中文",
            eng: getLanguage() === "en" ? "English" : "英文",
        };
        ocrText = t("ocrReady", {
            languages: (ocr.languages || []).map((item) => languageNames[item] || item).join(" + "),
        });
        ocrClass = "ready";
    } else if (ocr) {
        ocrClass = "error";
        if (getLanguage() === "zh-CN" && ocr.message) ocrText = ocr.message;
    }

    return (
        // 遮罩层：编辑类弹窗不响应遮罩点击（无 onClick 关闭逻辑）
        <div className={visible ? "preview-backdrop is-visible" : "preview-backdrop"}>
            <section className={visible ? "settings-dialog is-visible" : "settings-dialog"} role="dialog" aria-modal="true" aria-label={t("settingsTitle")}>
                <form id="settingsForm" ref={formRef} onSubmit={handleSave}>
                    <header className="dialog-header">
                        <h2>{t("settingsTitle")}</h2>
                        <Button variant="icon" className="close-button" aria-label={t("close")} title={t("close")} onClick={onClose}>
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                        </Button>
                    </header>
                    <div className="settings-content">
                        <section className="settings-section" aria-labelledby="modelServiceHeading">
                            <h3 id="modelServiceHeading">{t("modelService")}</h3>
                            <div className="settings-grid settings-model-grid">
                                <label className="field">
                                    <span>{t("endpoint")}</span>
                                    <input
                                        name="base_url"
                                        type="url"
                                        required
                                        placeholder="https://api.openai.com/v1"
                                        value={form.base_url}
                                        onChange={(event) => setField("base_url", event.target.value)}
                                    />
                                </label>
                                <label className="field">
                                    <span>{t("modelName")}</span>
                                    <input
                                        name="model"
                                        required
                                        placeholder={t("modelPlaceholder")}
                                        value={form.model}
                                        onChange={(event) => setField("model", event.target.value)}
                                    />
                                </label>
                                <label className="field">
                                    <span>{t("apiKey")}</span>
                                    <input
                                        name="api_key"
                                        type="password"
                                        autoComplete="off"
                                        placeholder={t("apiKeyPlaceholder")}
                                        value={form.api_key}
                                        onChange={(event) => setField("api_key", event.target.value)}
                                    />
                                </label>
                                <div className="settings-number-grid">
                                    <label className="field">
                                        <span>{t("parallelism")}</span>
                                        <input
                                            name="max_parallel"
                                            type="number"
                                            min={1}
                                            max={12}
                                            value={form.max_parallel}
                                            onChange={(event) => setField("max_parallel", event.target.value)}
                                        />
                                    </label>
                                    <label className="field">
                                        <span>{t("timeout")}</span>
                                        <input
                                            name="request_timeout"
                                            type="number"
                                            min={30}
                                            max={600}
                                            value={form.request_timeout}
                                            onChange={(event) => setField("request_timeout", event.target.value)}
                                        />
                                    </label>
                                </div>
                            </div>
                        </section>
                        <section className="settings-section" aria-labelledby="localProcessingHeading">
                            <h3 id="localProcessingHeading">{t("localProcessing")}</h3>
                            <div className="settings-grid">
                                <div className="field">
                                    <span>{t("ocrPath")}</span>
                                    <input
                                        name="ocr_executable"
                                        aria-label={t("ocrPath")}
                                        placeholder="Tesseract 程序路径（可留空自动检测）"
                                        value={form.ocr_executable}
                                        onChange={(event) => setField("ocr_executable", event.target.value)}
                                    />
                                    <small className={ocrClass}>{ocrText}</small>
                                </div>
                                <div className="field">
                                    <span>{t("asrApiKey")}</span>
                                    <div className="field-action-row">
                                        <input
                                            name="asr_api_key"
                                            type="password"
                                            autoComplete="off"
                                            aria-label={t("asrApiKey")}
                                            placeholder={t("apiKeyPlaceholder")}
                                            value={form.asr_api_key}
                                            onChange={(event) => setField("asr_api_key", event.target.value)}
                                        />
                                        <Button variant="secondary" onClick={handleClearAsr}>
                                            {t("clearAsr")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </section>
                        <section className="settings-section" aria-labelledby="feishuPushHeading">
                            <h3 id="feishuPushHeading">{t("feishuPushSettings")}</h3>
                            <div className="settings-grid">
                                <label className="field">
                                    <span>{t("feishuWebhook")}</span>
                                    <input
                                        name="feishu_webhook_url"
                                        type="url"
                                        placeholder={t("feishuWebhookPlaceholder")}
                                        value={form.feishu_webhook_url}
                                        onChange={(event) => setField("feishu_webhook_url", event.target.value)}
                                    />
                                </label>
                                <div className="field">
                                    <span>{t("feishuSign")}</span>
                                    <div className="field-action-row">
                                        <input
                                            name="feishu_sign_secret"
                                            type="password"
                                            autoComplete="off"
                                            aria-label={t("feishuSign")}
                                            placeholder={t("apiKeyPlaceholder")}
                                            value={form.feishu_sign_secret}
                                            onChange={(event) => setField("feishu_sign_secret", event.target.value)}
                                        />
                                        <Button variant="secondary" onClick={handleClearFeishuSign}>
                                            {t("clearAsr")}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <label className="toggle-row settings-feishu-toggle">
                                <input
                                    name="feishu_push_enabled"
                                    type="checkbox"
                                    checked={form.feishu_push_enabled}
                                    onChange={(event) => setField("feishu_push_enabled", event.target.checked)}
                                />
                                <span>{t("feishuPush")}</span>
                            </label>
                        </section>
                        <section className="settings-section" aria-labelledby="preferencesHeading">
                            <h3 id="preferencesHeading">{t("preferences")}</h3>
                            <div className="toggle-options">
                                <label className="toggle-row">
                                    <input
                                        name="retain_resume_text"
                                        type="checkbox"
                                        checked={form.retain_resume_text}
                                        onChange={(event) => setField("retain_resume_text", event.target.checked)}
                                    />
                                    <span>{t("retainText")}</span>
                                </label>
                                <label className="toggle-row">
                                    <input
                                        name="call_qa_records"
                                        type="checkbox"
                                        checked={form.call_qa_records}
                                        onChange={(event) => setField("call_qa_records", event.target.checked)}
                                    />
                                    <span>{t("callQaRecords")}</span>
                                </label>
                            </div>
                        </section>
                    </div>
                    <footer className="dialog-footer">
                        <div
                            className={message?.error ? "dialog-message error" : "dialog-message"}
                            role="status"
                            aria-live="polite"
                        >
                            {message?.text ?? ""}
                        </div>
                        <div className="dialog-actions">
                            <Button variant="secondary" busy={testingFeishu} onClick={handleTestFeishu}>
                                {testingFeishu ? t("testing") : t("testFeishu")}
                            </Button>
                            <Button variant="secondary" busy={testing} onClick={handleTestSettings}>
                                {testing ? t("testing") : t("testConnection")}
                            </Button>
                            <Button variant="primary" type="submit" busy={saving}>
                                {saving ? t("saving") : t("saveSettings")}
                            </Button>
                        </div>
                    </footer>
                </form>
            </section>
        </div>
    );
}
