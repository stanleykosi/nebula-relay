import { WithdrawPage } from "@/components/nebula/WithdrawPage";

export default async function PrivateRoute({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { intent } = await searchParams;
  return <WithdrawPage intentId={intent} />;
}
