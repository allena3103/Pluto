"use client";

import { Tabs } from "radix-ui";
import { Bot, Download, MousePointerClick, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ACCESS_SUMMARY,
  EXAMPLE_PROMPTS,
  MCP_PROMPTS,
  MCP_TOOLS,
  PROMPT_LOCATIONS,
  agentHandoff,
  claudeCodeCommand,
  codexCommand,
  cursorInstallLink,
  mcpServersJson,
  vscodeInstallLink,
  vscodeJson,
} from "@/lib/mcp-connect";
import { CopyButton } from "./copy-button";

const CARD = "rounded-3xl border border-border/80 bg-card p-5 shadow-warm";

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-[#2b211d] text-[#fdf1e7]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 py-1.5 pr-1.5 pl-4">
        <span className="truncate text-xs font-bold text-white/60">{label}</span>
        <CopyButton text={code} variant="ghost" size="xs" className="text-white hover:bg-white/15 hover:text-white" />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[0.8rem] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm font-medium text-foreground/90">{children}</ol>;
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Bot; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-extrabold text-foreground">
      <Icon className="size-4 text-primary" aria-hidden />
      {children}
    </h2>
  );
}

const CLIENTS = [
  { id: "claude", label: "Claude" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "other", label: "Other" },
] as const;

export function McpConnect({ serverUrl }: { serverUrl: string }) {
  const handoff = agentHandoff(serverUrl);

  return (
    <div className="space-y-4">
      {/* Server URL */}
      <section aria-labelledby="mcp-url" className={CARD}>
        <h2 id="mcp-url" className="text-sm font-bold text-muted-foreground">
          Server URL
        </h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 rounded-2xl bg-muted px-4 py-3 font-mono text-sm font-semibold break-all text-foreground">
            {serverUrl}
          </code>
          <CopyButton text={serverUrl} label="Copy URL" variant="sunrise" size="default" className="shrink-0" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          Streamable HTTP. You sign in with your Pluto account when the app asks, so there is no key to paste. It only
          sees your own data, and the one thing it can write is a study guide saved to your Notes.
        </p>
      </section>

      {/* Hand it to an agent */}
      <section aria-labelledby="mcp-handoff" className={CARD}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="mcp-handoff" className="flex items-center gap-2 text-base font-extrabold text-foreground">
              <Bot className="size-4 text-primary" aria-hidden />
              Hand it to your AI
            </h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Copy this and paste it into any agent. It has the URL, the tools and the setup steps.
            </p>
          </div>
          <CopyButton text={handoff} label="Copy for my agent" variant="sunrise" size="default" className="shrink-0" />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer rounded-full text-sm font-bold text-muted-foreground hover:text-foreground">
            See what gets copied
          </summary>
          <div className="mt-2">
            <CodeBlock code={handoff} label="Instructions for an agent" />
          </div>
        </details>
      </section>

      {/* Per-client setup */}
      <section aria-labelledby="mcp-clients" className={CARD}>
        <h2 id="mcp-clients" className="flex items-center gap-2 text-base font-extrabold text-foreground">
          <Download className="size-4 text-primary" aria-hidden />
          Add it to your app
        </h2>
        <Tabs.Root defaultValue="claude" className="mt-3">
          <Tabs.List aria-label="AI app" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-2">
            {CLIENTS.map((client) => (
              <Tabs.Trigger
                key={client.id}
                value={client.id}
                className="h-9 shrink-0 cursor-pointer rounded-full px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/30 focus-visible:outline-none data-[state=active]:bg-secondary data-[state=active]:text-secondary-foreground"
              >
                {client.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value="claude" className="mt-2 space-y-3 focus-visible:outline-none">
            <Steps>
              <li>In Claude, open Customize, then Connectors.</li>
              <li>Press +, then Add custom connector.</li>
              <li>Name it Pluto, paste the server URL and press Add.</li>
              <li>Press Connect and sign in to Pluto.</li>
            </Steps>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={serverUrl} label="Copy URL" />
              <Button asChild variant="outline" size="sm">
                <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">
                  Open Claude connectors
                </a>
              </Button>
            </div>
          </Tabs.Content>

          <Tabs.Content value="claude-code" className="mt-2 space-y-3 focus-visible:outline-none">
            <Steps>
              <li>Run this in your terminal.</li>
              <li>
                In Claude Code, type <code className="font-mono font-bold">/mcp</code>, pick pluto and sign in.
              </li>
            </Steps>
            <CodeBlock code={claudeCodeCommand(serverUrl)} label="Terminal" />
          </Tabs.Content>

          <Tabs.Content value="cursor" className="mt-2 space-y-3 focus-visible:outline-none">
            <Steps>
              <li>Press Add to Cursor and confirm the install.</li>
              <li>
                Or paste this into <code className="font-mono font-bold">~/.cursor/mcp.json</code>.
              </li>
            </Steps>
            <Button asChild variant="sunrise" size="sm">
              <a href={cursorInstallLink(serverUrl)}>Add to Cursor</a>
            </Button>
            <CodeBlock code={mcpServersJson(serverUrl)} label="~/.cursor/mcp.json" />
          </Tabs.Content>

          <Tabs.Content value="vscode" className="mt-2 space-y-3 focus-visible:outline-none">
            <Steps>
              <li>Press Add to VS Code and confirm the install.</li>
              <li>
                Or paste this into <code className="font-mono font-bold">.vscode/mcp.json</code>.
              </li>
            </Steps>
            <Button asChild variant="sunrise" size="sm">
              <a href={vscodeInstallLink(serverUrl)}>Add to VS Code</a>
            </Button>
            <CodeBlock code={vscodeJson(serverUrl)} label=".vscode/mcp.json" />
          </Tabs.Content>

          <Tabs.Content value="chatgpt" className="mt-2 space-y-3 focus-visible:outline-none">
            <Steps>
              <li>In ChatGPT, open Settings, then Apps (called Apps &amp; Connectors in some versions).</li>
              <li>Turn on Developer mode under Advanced settings.</li>
              <li>Choose Create app, name it Pluto and paste the server URL.</li>
              <li>Pick OAuth and sign in to Pluto.</li>
            </Steps>
            <p className="text-sm font-medium text-muted-foreground">
              Developer mode depends on your ChatGPT plan and may need a workspace admin to turn it on.
            </p>
            <CopyButton text={serverUrl} label="Copy URL" />
          </Tabs.Content>

          <Tabs.Content value="other" className="mt-2 space-y-3 focus-visible:outline-none">
            <p className="text-sm font-medium text-foreground/90">
              Any app that supports remote MCP servers over streamable HTTP with OAuth works. Most read a config like
              this one.
            </p>
            <CodeBlock code={mcpServersJson(serverUrl)} label="mcp.json" />
            <CodeBlock code={codexCommand(serverUrl)} label="Codex CLI" />
          </Tabs.Content>
        </Tabs.Root>
      </section>

      {/* One-click prompts */}
      <section aria-labelledby="mcp-prompts" className={CARD}>
        <div id="mcp-prompts">
          <SectionTitle icon={MousePointerClick}>One-click prompts</SectionTitle>
        </div>
        <ul className="mt-3 divide-y divide-border/70">
          {MCP_PROMPTS.map((prompt) => (
            <li key={prompt.name} className="py-2.5">
              <p className="text-sm font-bold text-foreground">
                {prompt.title} <code className="font-mono text-xs font-semibold text-muted-foreground">{prompt.name}</code>
              </p>
              <p className="mt-0.5 text-sm font-medium text-muted-foreground">{prompt.description}</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">
                Asks for:{" "}
                {prompt.arguments.map((arg, index) => (
                  <span key={arg.name}>
                    {index > 0 ? ", " : ""}
                    <code className="font-mono font-bold">{arg.name}</code>
                    {arg.required ? "" : " (optional)"}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <ul className="mt-3 space-y-1 text-sm font-medium text-foreground/90">
          {PROMPT_LOCATIONS.map((item) => (
            <li key={item.client}>
              <span className="font-extrabold">{item.client}:</span> {item.where}
            </li>
          ))}
        </ul>
      </section>

      {/* Try it */}
      <section aria-labelledby="mcp-try" className={CARD}>
        <div id="mcp-try">
          <SectionTitle icon={Sparkles}>Try asking</SectionTitle>
        </div>
        <ul className="mt-3 space-y-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <li key={prompt} className="flex items-center gap-2 rounded-2xl bg-butter/60 py-2 pr-2 pl-4">
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">{prompt}</p>
              <CopyButton text={prompt} variant="ghost" size="xs" className="shrink-0" />
            </li>
          ))}
        </ul>
      </section>

      {/* Tools */}
      <section aria-labelledby="mcp-tools" className={CARD}>
        <div id="mcp-tools">
          <SectionTitle icon={Wrench}>What your AI can do</SectionTitle>
        </div>
        <ul className="mt-3 divide-y divide-border/70">
          {MCP_TOOLS.map((tool) => (
            <li key={tool.name} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
              <code className="shrink-0 font-mono text-sm font-bold text-foreground sm:w-44">
                {tool.name}
                {tool.write ? (
                  <span className="ml-2 rounded-full bg-mint/70 px-2 py-0.5 font-sans text-[0.7rem] font-extrabold text-emerald-900">
                    saves
                  </span>
                ) : null}
              </code>
              <span className="text-sm font-medium text-muted-foreground">{tool.summary}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          {ACCESS_SUMMARY}
        </p>
      </section>
    </div>
  );
}
