import {AppShell} from '@/components/layout/app-shell';
import {DownloadQueue} from '@/components/operations/download-queue';
export default function DownloadsPage(){return <AppShell title="Download Queue" description="Processing, waiting and finished CRM reports, with manual controls."><DownloadQueue /></AppShell>;}
