import Image from "next/image";
import type { ComponentProps, ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingId, splitFaq, textOf, webHref, webSrc, type FaqImage } from "@/lib/faq";
import "./faq.css";

// docs/FAQ.md drawn on weft.zip/faq (app/faq/page.tsx). splitFaq() hands over the markdown and the raw-HTML image
// rows separately, so react-markdown never renders HTML; headings get GitHub's ids so the file's own links land.
function heading(Tag: "h1" | "h2" | "h3") {
  return function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={headingId(textOf(children))}>{children}</Tag>;
  };
}

function FaqImg({ src, alt }: { src: string; alt: string }) {
  return <Image src={webSrc(src)} alt={alt} width={0} height={0} sizes="(max-width: 860px) 100vw, 820px" unoptimized className="wz-faqImg" />;
}

const components: Components = {
  h1: heading("h1"),
  h2: heading("h2"),
  h3: heading("h3"),
  a: ({ href, children }: ComponentProps<"a">) => <a href={webHref(href ?? "")}>{children}</a>,
  img: ({ src, alt }: ComponentProps<"img">) => <FaqImg src={typeof src === "string" ? src : ""} alt={alt ?? ""} />,
};

function ImageRow({ images }: { images: FaqImage[] }) {
  return (
    <div className={images.length > 1 ? "wz-faqRow" : "wz-faqSolo"}>
      {images.map((img) => (
        <FaqImg key={img.src} src={img.src} alt={img.alt} />
      ))}
    </div>
  );
}

export default function FaqDoc({ markdown }: { markdown: string }) {
  return (
    <article className="wz-faqDoc">
      {splitFaq(markdown).map((seg, i) =>
        seg.kind === "markdown" ? (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
            {seg.text}
          </ReactMarkdown>
        ) : (
          <ImageRow key={i} images={seg.images} />
        ),
      )}
    </article>
  );
}
