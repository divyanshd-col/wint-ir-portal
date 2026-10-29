import { Metadata } from 'next';
import PcgCallsClient from '@/components/admin/PcgCallsClient';

export const metadata: Metadata = {
  title: 'PCG Call Recordings (Admin View) | Wint IR Portal',
  description: 'Admin view to review complete calls handled by PCG Team agents.',
};

export default function PcgCallsPage() {
  return <PcgCallsClient />;
}
