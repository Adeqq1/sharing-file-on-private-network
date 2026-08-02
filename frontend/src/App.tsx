import { CustomColorDemo, DefaultDemo } from "@/components/demo/expandable-tabs-demo";

function App() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <section className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">
            shadcn/ui component
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Expandable Tabs</h1>
          <p className="max-w-2xl text-muted-foreground">
            Demo React + TypeScript + Tailwind untuk komponen expandable tabs.
          </p>
        </section>

        <section className="space-y-4 rounded-3xl border bg-white/50 p-6 shadow-sm dark:bg-black/20">
          <h2 className="text-lg font-medium">Default</h2>
          <DefaultDemo />
        </section>

        <section className="space-y-4 rounded-3xl border bg-white/50 p-6 shadow-sm dark:bg-black/20">
          <h2 className="text-lg font-medium">Custom Color</h2>
          <CustomColorDemo />
        </section>
      </div>
    </main>
  );
}

export default App;
