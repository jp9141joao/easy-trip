/**
 * Test setup.
 *
 * Native modules are replaced with in-memory equivalents so the domain and
 * repository layers can be exercised in Node without a device.
 */

/* ------------------------------ AsyncStorage ------------------------------ */

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      multiRemove: jest.fn(async (keys: string[]) => {
        keys.forEach((key) => delete store[key]);
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

/* -------------------------------- SecureStore ----------------------------- */

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

/* ---------------------------------- Crypto -------------------------------- */

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    }),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hashed:${value}`),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

/* ------------------------------- File system ------------------------------ */

jest.mock('expo-file-system', () => {
  /**
   * Sistema de arquivos em memória.
   *
   * O dublê anterior respondia `exists = true` para tudo e `copy()` não fazia
   * nada — bastava para as telas, mas não serve para a F8: o espelho local da
   * D-04 é justamente a diferença entre "o arquivo está aqui" e "não está", e
   * um dublê que responde sempre "está" faria o teste passar sem medir nada.
   */
  const arquivos = new Map<string, Uint8Array>();
  const pastas = new Set<string>(['file:///documents', 'file:///cache']);

  const juntar = (segments: unknown[]) =>
    segments
      .map((s) => (s && typeof s === 'object' && 'uri' in s ? String((s as { uri: string }).uri) : String(s)))
      .join('/');

  class FakeDirectory {
    uri: string;
    constructor(...segments: unknown[]) {
      this.uri = juntar(segments);
    }
    get exists() {
      return pastas.has(this.uri);
    }
    create(options?: { intermediates?: boolean }) {
      pastas.add(this.uri);
      // `intermediates: true` cria a árvore inteira no expo-file-system real.
      // Sem isto, uma pasta-pai existiria só implicitamente e um `delete()`
      // nela não encontraria nada — que foi exatamente o que o teste do
      // expurgo por conta pegou.
      if (options?.intermediates !== false) {
        const partes = this.uri.split('/');
        while (partes.length > 3) {
          partes.pop();
          pastas.add(partes.join('/'));
        }
      }
    }
    delete() {
      for (const chave of [...pastas]) if (chave.startsWith(this.uri)) pastas.delete(chave);
      for (const chave of [...arquivos.keys()]) if (chave.startsWith(this.uri + '/')) arquivos.delete(chave);
    }
  }

  class FakeFile {
    uri: string;
    constructor(...segments: unknown[]) {
      this.uri = juntar(segments);
    }
    get exists() {
      return arquivos.has(this.uri);
    }
    create() {
      if (!arquivos.has(this.uri)) arquivos.set(this.uri, new Uint8Array(0));
    }
    write(bytes: Uint8Array) {
      arquivos.set(this.uri, bytes);
    }
    async copy(destino: FakeFile) {
      arquivos.set(destino.uri, arquivos.get(this.uri) ?? new Uint8Array([1, 2, 3]));
    }
    delete() {
      arquivos.delete(this.uri);
    }
    async arrayBuffer() {
      const bytes = arquivos.get(this.uri) ?? new Uint8Array(0);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  }

  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: {
      document: new FakeDirectory('file:///documents'),
      cache: new FakeDirectory('file:///cache'),
    },
    /** Só para os testes: zera o disco entre cenários. */
    __reset: () => {
      arquivos.clear();
      pastas.clear();
      pastas.add('file:///documents');
      pastas.add('file:///cache');
    },
    __files: arquivos,
  };
});

/* --------------------------------- Silence -------------------------------- */

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

/* --------------------------------- Ícones --------------------------------- */

// `lucide-react-native` só publica ESM (.mjs), que o transform do jest-expo não
// cobre. Os ícones são decorativos, então um stub basta para que os componentes
// que os usam possam ser renderizados em teste.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
