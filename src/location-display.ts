export function frankfurtDisplay(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized === "frankfurt" || normalized === "frankfurt am main" ? "法兰克福" : value;
}

const cityNames: Record<string, string> = {
  "los angeles": "洛杉矶", "san jose": "圣何塞", osaka: "大阪", tokyo: "东京",
  "hong kong": "香港", singapore: "新加坡", guangzhou: "广州", shanghai: "上海",
  beijing: "北京", seoul: "首尔", london: "伦敦", frankfurt: "法兰克福",
  amsterdam: "阿姆斯特丹", sydney: "悉尼", "new york": "纽约", seattle: "西雅图",
};

export function cityDisplay(value: string): string {
  return frankfurtDisplay(cityNames[value.trim().toLowerCase()] || value);
}
