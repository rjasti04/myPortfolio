/**
 * Lightweight Code Syntax Highlighter Engine
 * Parses raw code text into syntax-highlighted HTML spans
 * Supports Python, JavaScript, SQL, JSON, HTML, Bash/Shell
 */

const KEYWORDS = {
  python: /\b(def|class|return|import|from|as|if|elif|else|for|while|try|except|finally|raise|with|lambda|yield|async|await|None|True|False|and|or|not|is|in|pass|break|continue)\b/g,
  javascript: /\b(function|const|let|var|return|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|import|export|from|default|class|extends|new|this|async|await|yield|null|undefined|true|false|typeof|instanceof)\b/g,
  sql: /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|PRIMARY|KEY|FOREIGN|REFERENCES|AND|OR|NOT|IN|EXISTS|LIKE|BETWEEN|IS|NULL|AS|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|UNION|ALL|WITH)\b/gi,
  bash: /\b(echo|export|cd|ls|mkdir|rm|chmod|chown|git|curl|wget|python|python3|npm|npx|pip|systemctl|sudo|grep|find|sed|awk|docker|kubectl)\b/g,
  json: /\b(true|false|null)\b/g
};

export function highlightCode(code, lang = "") {
  if (!code) return "";
  
  const normalizedLang = (lang || "").toLowerCase().trim();
  
  // Basic HTML escaping first
  let escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Regex patterns
  const comments = normalizedLang === "python" || normalizedLang === "bash" 
    ? /(#.*$)/gm 
    : normalizedLang === "sql" 
      ? /(--.*$|\/\*[\s\S]*?\*\/)/gm 
      : /(\/\/.*$|\/\*[\s\S]*?\*\/)/gm;

  const strings = /(["'`])(?:(?=(\\?))\2[\s\S])*?\1/g;
  const numbers = /\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/g;
  const functions = /\b([a-zA-Z_]\w*)(?=\()/g;

  // Placeholder map to protect matches from double-wrapping
  const placeholders = [];
  const mask = (text, type) => {
    const key = `___TOKEN_${placeholders.length}___`;
    placeholders.push({ key, html: `<span class="token-${type}">${text}</span>` });
    return key;
  };

  // Mask Comments
  escaped = escaped.replace(comments, (match) => mask(match, "comment"));

  // Mask Strings
  escaped = escaped.replace(strings, (match) => mask(match, "string"));

  // Mask Keywords
  const kwRegex = KEYWORDS[normalizedLang] || KEYWORDS.javascript;
  escaped = escaped.replace(kwRegex, (match) => mask(match, "keyword"));

  // Mask Functions
  escaped = escaped.replace(functions, (match) => mask(match, "function"));

  // Mask Numbers
  escaped = escaped.replace(numbers, (match) => mask(match, "number"));

  // Restore placeholders in reverse order. The replacement is a function, not
  // the string itself: a string replacement is scanned for `$&`, `` $` ``,
  // `$'` and `$$`, so a highlighted JS literal like '$&' rendered as the
  // placeholder it was replacing. A function's return value is used verbatim.
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { key, html } = placeholders[i];
    escaped = escaped.replace(key, () => html);
  }

  return `<code class="highlighted-code lang-${normalizedLang}">${escaped}</code>`;
}
