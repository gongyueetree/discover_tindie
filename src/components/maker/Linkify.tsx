/** Plain text with its http(s) URLs turned into links that open in a new tab. */
export default function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')\]]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const url = p.replace(/[.,;:!?]+$/, "");
        const tail = p.slice(url.length);
        let safe = false;
        try {
          const u = new URL(url);
          safe = (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password;
        } catch {}
        return safe ? (
          <span key={i}>
            <a className="inline-link" href={url} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()}>
              {url.replace(/^https?:\/\//, "")}
            </a>
            {tail}
          </span>
        ) : (
          p
        );
      })}
    </>
  );
}
