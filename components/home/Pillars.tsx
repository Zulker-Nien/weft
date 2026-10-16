import { PILLARS } from "@/lib/home";

// The section under the screenshot: the five things Weft stands on (PILLARS in lib/home.ts), two wide cards over three.
export default function Pillars() {
  return (
    <section className="wz-wrap wz-pillars" aria-labelledby="wz-pillarsTitle">
      <h2 id="wz-pillarsTitle" className="wz-h2">
        Everything a build needs, <em>woven in.</em>
      </h2>
      <div className="wz-pillarGrid">
        {PILLARS.map((p) => (
          <article key={p.kicker} className="wz-pillar">
            <p className="wz-pillarKicker">{p.kicker}</p>
            <h3 className="wz-pillarTitle">{p.title}</h3>
            <p className="wz-pillarBody">{p.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
