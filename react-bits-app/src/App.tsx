import SplitText from '@/components/SplitText'

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 text-foreground">
      <SplitText
        text="Life, Unsaid"
        tag="h1"
        className="text-5xl font-semibold tracking-tight sm:text-7xl"
        delay={60}
        duration={1}
        splitType="chars"
      />
      <p className="text-muted-foreground">React Bits is installed. Ask Claude to add any component.</p>
    </main>
  )
}

export default App
