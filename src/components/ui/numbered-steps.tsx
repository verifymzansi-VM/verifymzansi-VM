export function NumberedSteps({ steps }: { steps: readonly { title: string; body: string }[] }) {
  return (
    <ol className="mt-4 space-y-4">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-green/10 text-xs font-bold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-gold-300"
          >
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{step.title}</p>
            <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
