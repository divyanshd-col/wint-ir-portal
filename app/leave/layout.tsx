import HrmsLayout from '@/components/hrms/HrmsLayout';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  return <HrmsLayout area="leave">{children}</HrmsLayout>;
}
