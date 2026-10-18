// Every test file: end this worker if the vitest run that started it dies (lib/orphan-guard.ts).
import { guardOrphan } from "../lib/orphan-guard";

guardOrphan();
