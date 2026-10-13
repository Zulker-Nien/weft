import Home from "@/components/home/Home";
import { homeMetadata } from "@/lib/home";

// The weft.zip home page, reachable on any Weft at /home; on the deployed Weft, app/page.tsx serves it at / too.
export const metadata = homeMetadata(process.env.NEXT_PUBLIC_APP_VERSION ?? "");

export default function Page() {
  return <Home />;
}
