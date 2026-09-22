#!/usr/bin/env node
/** One curated server definition from servers/*.json. */
interface ServerDef {
    id: string;
    serverName: string;
    title: string;
    description: string;
    transport: 'stdio' | 'streamable-http';
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    requiredEnv?: string[];
    verify?: {
        status?: string;
        note?: string;
    };
}
export declare function dshHome(): string;
/** Load the curated catalog shipped in servers/*.json. */
export declare function loadCatalog(): ServerDef[];
/** List profiles under $DSH_HOME/profiles. */
export declare function listProfiles(home?: string): string[];
/**
 * Render one catalog entry as a cordis.patch.yml loader entry.
 *
 * The user patch layer is applied ON TOP of the composed bundle tree, where a
 * bare `- id:` entry means "override that existing entry" — naming a new id
 * that way produces `patch: entry "x" not found` and does nothing. New entries
 * must go through `insert:`.
 */
export declare function renderEntry(def: ServerDef): string;
/** Merge new entries into an existing patch file, preserving user content. */
export declare function writePatchFile(file: string, entries: string[]): {
    created: boolean;
    appended: number;
};
/** Parse the mcp-client entries currently present in a profile's patch layer. */
export declare function readProfileServers(profile: string): {
    id: string;
    serverName: string;
    transport: string;
}[];
export {};
