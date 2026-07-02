const integrations = ['Planilha / Excel', 'EAN / GTIN', 'Wake Commerce', 'Marketplaces'];

export default function IntegrationsGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      {integrations.map((name) => (
        <div
          key={name}
          className="rounded-xl border border-ink/10 bg-white px-5 py-6 text-center font-bold text-ink/70 shadow-sm transition hover:-translate-y-1 hover:shadow-lg hover:border-orange/30 hover:text-ink"
        >
          {name}
        </div>
      ))}
    </div>
  );
}
