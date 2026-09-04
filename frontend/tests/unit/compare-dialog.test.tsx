import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompareDialog, type CompareCandidate } from "../../src/ui/CompareDialog";

const candidates: CompareCandidate[] = [
  { source_file: "a.pdf", candidate_name: "张三", conclusion: "A优先约面" },
  { source_file: "b.pdf", candidate_name: "李四", conclusion: "B电话确认" },
];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function deferred<T>() {
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
}

describe("候选人横向对比", () => {
  it("提交全部候选人并展示排序结果", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      ranking: [
        { candidate: "张三（a.pdf）", rank: 1, reason: "项目经历匹配" },
        { candidate: "李四（b.pdf）", rank: 2, reason: "需要电话确认" },
      ],
    }));

    render(<CompareDialog open jobId="job-1" candidates={candidates} onClose={vi.fn()} />);

    await screen.findByText("项目经历匹配");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^\/api\/jobs\/job-1\/compare\?cancel_key=/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ files: ["a.pdf", "b.pdf"] });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("关闭进行中的对比会使用同一 cancel_key 取消请求", async () => {
    const pending = deferred<Response>();
    fetchMock.mockImplementation((url: unknown) =>
      String(url).includes("/compare/cancel") ? Promise.resolve(jsonResponse({ ok: true })) : pending.promise
    );
    const onClose = vi.fn();
    render(<CompareDialog open jobId="job-1" candidates={candidates} onClose={onClose} />);
    await screen.findByText("AI 正在对比分析…");
    const requestKey = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost").searchParams.get("cancel_key");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/jobs/job-1/compare/cancel");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ cancel_key: requestKey });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    pending.reject(new Error("对比请求已取消。"));
  });
});
