const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "src");
const OUTPUT_FILE = path.join(__dirname, "src-map.txt");

function generateTree(dir, prefix = "") {
  let result = "";
  const items = fs.readdirSync(dir);

  items.forEach((item, index) => {
    const fullPath = path.join(dir, item);
    const isLast = index === items.length - 1;
    const connector = isLast ? "└── " : "├── ";

    result += prefix + connector + item + "\n";

    if (fs.statSync(fullPath).isDirectory()) {
      const newPrefix = prefix + (isLast ? "    " : "│   ");
      result += generateTree(fullPath, newPrefix);
    }
  });

  return result;
}

if (!fs.existsSync(SRC_DIR)) {
  console.error("❌ src folder not found!");
  process.exit(1);
}

const treeStructure = "src\n" + generateTree(SRC_DIR);

fs.writeFileSync(OUTPUT_FILE, treeStructure);

console.log("✅ Folder map generated successfully!");
console.log(`📄 Saved to: ${OUTPUT_FILE}`);