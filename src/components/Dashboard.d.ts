import type { ComponentType } from "react";

declare const Dashboard: ComponentType<{
  demo?: boolean;
  session: { user: { email?: string } };
}>;
export default Dashboard;
