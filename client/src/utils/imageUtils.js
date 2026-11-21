// Narzędzia do obsługi i kompresji zdjęć po stronie klienta (Canvas API)

export const MAX_RAW_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB przed kompresją
export const MAX_GIF_PASSTHROUGH_BYTES = 1.5 * 1024 * 1024; // 1.5 MB dla animowanych GIF-ów
export const MAX_ENCODED_DATA_URL_LENGTH = 3 * 1024 * 1024; // ~2.2 MB binarnie

export const QUESTION_IMAGE_OPTIONS = {
  maxWidth: 1280,
  maxHeight: 720,
  quality: 0.82,
};

export const ANSWER_IMAGE_OPTIONS = {
  maxWidth: 640,
  maxHeight: 480,
  quality: 0.8,
};

export function isValidImageValue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    /^data:image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(
      trimmed
    ) || /^https?:\/\/.+/i.test(trimmed)
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku obrazu.'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Nie udało się wczytać obrazu. Upewnij się, że plik nie jest uszkodzony.'));
    img.src = url;
  });
}

function canvasToCompressedDataUrl(canvas, originalType, quality) {
  // Preferuj WebP (świetna kompresja + obsługa przezroczystości)
  const webp = canvas.toDataURL('image/webp', quality);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }

  // Fallback dla przeglądarek bez eksportu WebP w Canvas
  if (originalType === 'image/png' || originalType === 'image/svg+xml') {
    return canvas.toDataURL('image/png');
  }
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Waliduje, opcjonalnie skaluje i kompresuje wybrany plik obrazu do formatu data URL.
 */
export async function processImageFile(file, options = QUESTION_IMAGE_OPTIONS) {
  if (!file) {
    throw new Error('Nie wybrano pliku.');
  }
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error('Wybrany plik nie jest obrazem (obsługiwane: JPG, PNG, WebP, GIF).');
  }
  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('Plik jest zbyt duży (maksymalnie 10 MB).');
  }

  // Zachowaj animację GIF dla niewielkich plików
  if (file.type === 'image/gif' && file.size <= MAX_GIF_PASSTHROUGH_BYTES) {
    const gifUrl = await readFileAsDataUrl(file);
    if (gifUrl.length <= MAX_ENCODED_DATA_URL_LENGTH) {
      return gifUrl;
    }
  }

  const { maxWidth, maxHeight, quality } = {
    ...QUESTION_IMAGE_OPTIONS,
    ...options,
  };

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(objectUrl);
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    if (!naturalWidth || !naturalHeight) {
      throw new Error('Nieprawidłowe wymiary obrazu.');
    }

    const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return await readFileAsDataUrl(file);
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvasToCompressedDataUrl(canvas, file.type, quality);
    if (dataUrl.length > MAX_ENCODED_DATA_URL_LENGTH) {
      // Spróbuj mocniejszej kompresji JPEG jako fallback
      const smaller = canvas.toDataURL('image/jpeg', 0.65);
      if (smaller.length > MAX_ENCODED_DATA_URL_LENGTH) {
        throw new Error('Obraz po kompresji nadal przekracza dopuszczalny rozmiar.');
      }
      return smaller;
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

