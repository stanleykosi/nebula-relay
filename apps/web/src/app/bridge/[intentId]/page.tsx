import { ProgressPage } from "@/components/nebula/ProgressPage";

export default async function BridgeProgressRoute({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  return <ProgressPage intentId={intentId} />;
}
