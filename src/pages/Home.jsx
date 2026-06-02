import { useInbox } from '../context/InboxContext.jsx';
import DailyBrief from '../components/Home/DailyBrief.jsx';
import PulseStrip from '../components/Home/PulseStrip.jsx';
import OwnerBalancesWidget from '../components/Home/OwnerBalancesWidget.jsx';
import Inbox from '../components/Inbox/Inbox.jsx';
import styles from './Home.module.css';

export default function Home() {
  const { inboxItems } = useInbox();

  return (
    <div className={styles.page}>
      <DailyBrief />

      <Inbox
        items={inboxItems}
        grouping="urgency"
        title="Omni Inbox"
      />

      <PulseStrip />

      {/* FF-1 — owner current-account balances (renders only when owners exist) */}
      <OwnerBalancesWidget />
    </div>
  );
}
