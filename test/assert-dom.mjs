import assert from "node:assert/strict";

/**
 * 断言 DOM 查询结果为空。
 * 不要用 assert.equal(node, null)：失败时 util.inspect 会沿着 linkedom 环引用序列化，轻易 OOM。
 * @param {Node | null | undefined} node
 * @param {string} [message]
 */
export function assertNoNode(node, message = "expected no matching node") {
  assert.equal(node == null, true, message);
}

/**
 * @param {Node | null | undefined} node
 * @param {string} [message]
 */
export function assertHasNode(node, message = "expected a matching node") {
  assert.equal(node != null, true, message);
}
