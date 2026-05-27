import { useInbox } from '../context/InboxContext.jsx';
import DailyBrief from '../components/Home/DailyBrief.jsx';
import PulseStrip from '../components/Home/PulseStrip.jsx';
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
    </div>
  );
}
