import RouteModal from '@/components/shell/RouteModal';
import AnalyticsPageContent from '@/components/AnalyticsPageContent';

// The MCP tab opens as a popup over the current page; /analytics directly (or a refresh) is still the full page.
export default function AnalyticsPopup() {
  return (
    <RouteModal label="MCP" size="narrow">
      <AnalyticsPageContent inModal />
    </RouteModal>
  );
}
