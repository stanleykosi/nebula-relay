import { TransferDetailPage } from "@/components/nebula/TransferDetailPage";

export default async function ActivityDetailRoute({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  return <TransferDetailPage intentId={intentId} />;
}
