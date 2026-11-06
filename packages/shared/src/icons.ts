/** Verzeichnis der auswählbaren Icons (Referenzen ohne Präfix, z. B. `proxmox` oder `foo.png`). */
export interface IconCatalog {
  /** Dashboard Icons (homarr-labs), Präfix `di:` */
  di: string[];
  /** selfh.st Icons, Präfix `sh:` */
  sh: string[];
  /** Stand der Listen; 1970, wenn noch nie geladen werden konnte. */
  updatedAt: string;
}
