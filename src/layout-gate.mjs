/**
 * 布局门控：在自定义列模式就绪前隐藏原生结果区，避免「先原生再跳布局」闪现。
 */

const READY_ATTR = "bspReady";
const SAFETY_MS = 4000;

/**
 * 开始门控：结果区保持隐藏，直到 endLayoutGate。
 * @param {Document} document
 */
export function beginLayoutGate(document) {
  const root = document.documentElement;
  if (!root) return;
  delete root.dataset[READY_ATTR];
}

/**
 * 结束门控：显示结果区（无论自定义布局还是回退原生）。
 * @param {Document} document
 */
export function endLayoutGate(document) {
  const root = document.documentElement;
  if (!root) return;
  root.dataset[READY_ATTR] = "1";
}

/**
 * @param {Document} document
 * @returns {boolean}
 */
export function isLayoutGateReady(document) {
  return document.documentElement?.dataset?.[READY_ATTR] === "1";
}

/**
 * document_start 时 DOM 可能尚未就绪；等到 interactive/complete 再 boot。
 * @param {Document} document
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 */
export function waitForDocumentLoad(document, timeoutMs = SAFETY_MS) {
  const state = document.readyState;
  if (state === "interactive" || state === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener("DOMContentLoaded", finish);
      resolve();
    };
    document.addEventListener("DOMContentLoaded", finish, { once: true });
    const timer = (globalThis.setTimeout ?? setTimeout)(finish, timeoutMs);
    // linkedom 等环境可能没有 clearTimeout 绑定；忽略清理失败
    void timer;
  });
}

/**
 * 等到结果容器出现，或超时后继续（由后续 MutationObserver 补布局）。
 * @param {Document} document
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} 是否已找到结果根
 */
export function waitForResultsShell(document, timeoutMs = 2500) {
  if (findResultsShell(document)) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    /** @type {{ disconnect: () => void } | null} */
    let observer = null;
    /** @type {ReturnType<typeof setInterval> | 0} */
    let poll = 0;

    const finish = (found) => {
      if (settled) return;
      settled = true;
      try {
        observer?.disconnect();
      } catch {
        // ignore
      }
      if (poll) (globalThis.clearInterval ?? clearInterval)(poll);
      (globalThis.clearTimeout ?? clearTimeout)(timer);
      resolve(found);
    };

    const check = () => {
      if (findResultsShell(document)) finish(true);
    };

    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(check);
      const target = document.documentElement ?? document.body;
      if (target) observer.observe(target, { childList: true, subtree: true });
    } else {
      // linkedom 等测试环境无 MutationObserver，用轮询兜底
      poll = (globalThis.setInterval ?? setInterval)(check, 16);
    }
    const timer = (globalThis.setTimeout ?? setTimeout)(() => finish(false), timeoutMs);
  });
}

/**
 * @param {Document} document
 * @returns {Element | null}
 */
export function findResultsShell(document) {
  return (
    document.getElementById("content_left")
    ?? document.getElementById("rso")
    ?? document.getElementById("search")
    ?? document.getElementById("center_col")
  );
}

/**
 * 超时兜底：避免脚本异常导致结果区永久不可见。
 * @param {Document} document
 * @param {number} [timeoutMs]
 * @returns {() => void} cancel
 */
export function armLayoutGateSafety(document, timeoutMs = SAFETY_MS) {
  const timer = (globalThis.setTimeout ?? setTimeout)(() => {
    endLayoutGate(document);
  }, timeoutMs);
  return () => {
    (globalThis.clearTimeout ?? clearTimeout)(timer);
  };
}
