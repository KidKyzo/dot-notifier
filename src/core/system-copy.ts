const copy = {
  en: {
    heading: "System",
    cpu: "CPU",
    gpu: "GPU",
    memory: "Memory",
    vram: "VRAM",
    temperature: "GPU temperature",
    unavailable: "Unavailable",
    noSamples: "Waiting for system metrics",
    demoAlert: "System alert",
    system: "System",
    history: (label: string) => `${label} history for the past 60 seconds`,
    warningAlert: "System threshold exceeded",
    criticalAlert: "System load is critical",
  },
  id: {
    heading: "Sistem",
    cpu: "CPU",
    gpu: "GPU",
    memory: "Memori",
    vram: "VRAM",
    temperature: "Suhu GPU",
    unavailable: "Tidak tersedia",
    noSamples: "Menunggu metrik sistem",
    demoAlert: "Peringatan sistem",
    system: "Sistem",
    history: (label: string) => `Riwayat ${label} selama 60 detik terakhir`,
    warningAlert: "Ambang batas sistem terlampaui",
    criticalAlert: "Beban sistem kritis",
  },
} as const;

export const systemCopy = navigator.language.toLowerCase().startsWith("id") ? copy.id : copy.en;
