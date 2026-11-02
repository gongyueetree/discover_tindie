import {MakerHome} from '@/components/maker/Home';
import {ToolShell} from '@/components/maker/ToolShell';
import {DiscoverContent} from '@/components/maker/DiscoverContent';
export const dynamic='force-dynamic';
export default function Embed(){return <div className="maker-embedded"><ToolShell><MakerHome/></ToolShell></div>}
