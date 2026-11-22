import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default function ResearchOutput({ text }: { text: string }) {
  return <div className="max-w-[76ch] break-words text-sm leading-relaxed
    [&_p+p]:mt-3 [&_li+li]:mt-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
    [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:my-2 [&_pre]:overflow-x-auto
    [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold
    [&_.katex-display]:overflow-x-auto">
    <Markdown skipHtml disallowedElements={["img", "a"]} unwrapDisallowed
      remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, maxExpand: 100, maxSize: 20 }]]}>
      {text}
    </Markdown>
  </div>;
}
