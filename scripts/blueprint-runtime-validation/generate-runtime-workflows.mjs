import { generateMatrix, parseArgs } from "./harness.mjs";

const args = parseArgs(process.argv.slice(2));
const manifest = generateMatrix({
  strategyId: args.strategy,
  templateId: args.template,
});

console.log(
  JSON.stringify(
    { generatedAt: manifest.generatedAt, cases: manifest.cases },
    null,
    2,
  ),
);
