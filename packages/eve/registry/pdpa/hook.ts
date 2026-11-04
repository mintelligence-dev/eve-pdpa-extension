import { pdpa } from "../lib/pdpa.js";

// Ties each conversation to its tokens, so pdpa.tool() can resolve them, and
// deletes them when the session ends.
export default pdpa.hook;
