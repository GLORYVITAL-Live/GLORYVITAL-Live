import { App } from "@/components/App";
import { getMe } from "@/lib/auth";

export default async function Home() {
  const me = await getMe();
  return <App me={me} />;
}
