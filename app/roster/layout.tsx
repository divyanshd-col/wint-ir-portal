import HrmsLayout from '@/components/hrms/HrmsLayout';

export default function RosterLayout({ children }: { children: React.ReactNode }) {
  return <HrmsLayout area="roster">{children}</HrmsLayout>;
}
