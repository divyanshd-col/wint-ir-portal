import RouteModal from '@/components/shell/RouteModal';
import SettingsPageContent from '@/components/settings/SettingsPageContent';

// Opening Settings from anywhere in the app (the top bar gear) shows it as a popup over the current page.
// Visiting /settings directly, or refreshing, still gives the full page (app/settings/page.tsx).
export default function SettingsPopup() {
  return (
    <RouteModal label="Settings">
      <SettingsPageContent inModal />
    </RouteModal>
  );
}
