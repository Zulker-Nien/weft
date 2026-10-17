import Link from "next/link";
import { FAQ_HIGHLIGHTS, headingId } from "@/lib/faq";
import "./faq.css";

// The home page's short FAQ, under the pillars: FAQ_HIGHLIGHTS as <details> rows (no client JS), each linking to its
// full answer on /faq, and a link to the whole thing.
export default function FaqTeaser() {
  return (
    <section className="wz-wrap wz-faq" aria-labelledby="wz-faqTitle">
      <h2 id="wz-faqTitle" className="wz-h2">
        Questions, <em>answered.</em>
      </h2>
      <div className="wz-faqList">
        {FAQ_HIGHLIGHTS.map((h) => (
          <details key={h.question} className="wz-faqItem">
            <summary>{h.question}</summary>
            <p>
              {h.answer} <Link href={`/faq#${headingId(h.question)}`}>More</Link>
            </p>
          </details>
        ))}
      </div>
      <p className="wz-faqMore">
        <Link href="/faq">Read the full FAQ →</Link>
      </p>
    </section>
  );
}
