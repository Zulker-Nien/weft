// BlastCP's rocket mark (from the BlastCP repo's public/brand/rocket-180.png, shrunk to 64px): the rail
// button, the drawer header and a linked property's name.
export default function BlastcpLogo({ size = 14 }: { size?: number }) {
  return <img src="/brand/blastcp-rocket.png" alt="" width={size} height={size} className="inline-block shrink-0 select-none align-[-2px]" draggable={false} />;
}
