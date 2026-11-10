import { Monitor } from "lucide-react";
import { siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siRockylinux, siUbuntu } from "simple-icons";
import type { ProbeServer } from "./types";
import { locationName } from "./emerald-model";
import { extractRegionFromNodeName } from "./country-flag";

export function OsIcon({ os }: { os?: string }) {
  if (!os) return null;
  const name = os.toLowerCase();
  const icon = [siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siRockylinux, siUbuntu].find(icon => name.includes(icon.title.toLowerCase().split(" ")[0])) || (name.includes("linux") ? siLinux : undefined);
  return <span className="os-icon" title={os}>{icon ? <svg viewBox="0 0 24 24" width="16" height="16" role="img" aria-label={os}><path fill={`#${icon.hex}`} d={icon.path} /></svg> : <Monitor size={16} aria-label={os} />}</span>;
}
export function RegionFlag({ server }: { server: ProbeServer }) {
  const code = [server.region_country, server.region, extractRegionFromNodeName(server.name || "")?.countryCode].find(code => code && /^[a-z]{2}$/i.test(code));
  if (!code) return null;
  const file = [...code.toUpperCase()].map(character => (character.charCodeAt(0) + 127397).toString(16)).join("-");
  return <img className="region-flag" src={`/twemoji/svg/${file}.svg`} alt={locationName(server) || code} title={locationName(server) || code} />;
}
