/**
 * Mocks de HTML con schema.org para tests.
 */

export const HTML_EMPTY = "<!DOCTYPE html><html><body></body></html>";

export const HTML_NO_JSON_LD = `
<!DOCTYPE html>
<html>
<head><title>Shop</title></head>
<body>
  <h1>Product</h1>
  <p class="price">29.99 €</p>
</body>
</html>`;

export const HTML_PRODUCT_SCHEMA = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Camiseta Básica",
    "url": "https://example.com/camiseta",
    "image": "https://example.com/img/camiseta.jpg",
    "offers": {
      "@type": "Offer",
      "price": 29.99,
      "priceCurrency": "EUR"
    },
    "additionalProperty": [
      { "name": "size", "value": "L" },
      { "name": "color", "value": "negro" }
    ]
  }
  </script>
</head>
<body></body>
</html>`;

export const HTML_PRODUCT_SCHEMA_PRICE_STRING = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Zapatilla Running",
    "offers": {
      "@type": "Offer",
      "price": "89,99",
      "priceCurrency": "EUR"
    }
  }
  </script>
</head>
<body></body>
</html>`;

export const HTML_ITEMLIST_SCHEMA = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "item": {
          "@type": "Product",
          "name": "Producto A",
          "url": "https://example.com/a",
          "offers": { "@type": "Offer", "price": 10, "priceCurrency": "EUR" }
        }
      },
      {
        "@type": "ListItem",
        "item": {
          "@type": "Product",
          "name": "Producto B",
          "offers": { "@type": "Offer", "price": 20, "priceCurrency": "USD" }
        }
      }
    ]
  }
  </script>
</head>
<body></body>
</html>`;

export const HTML_OFFER_SCHEMA = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Offer",
    "price": 15.50,
    "priceCurrency": "EUR",
    "itemOffered": {
      "@type": "Product",
      "name": "Oferta Producto",
      "url": "https://example.com/oferta"
    }
  }
  </script>
</head>
<body></body>
</html>`;

export const HTML_INVALID_JSON_LD = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  { invalid json here }
  </script>
</head>
<body></body>
</html>`;

export const HTML_PRODUCT_NO_PRICE = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Sin precio",
    "url": "https://example.com/sin-precio"
  }
  </script>
</head>
<body></body>
</html>`;

export const HTML_SINGLE_PRODUCT_PAGE = `
<!DOCTYPE html>
<html>
<head><title>Product</title></head>
<body>
  <h1>Camiseta Azul</h1>
  <span class="price" itemprop="price">19.99</span>
  <span class="size" itemprop="size">M</span>
  <span class="color" itemprop="color">azul</span>
  <img itemprop="image" src="/img/camiseta.jpg" alt="Camiseta" />
</body>
</html>`;

export const HTML_PRODUCT_CARDS = `
<!DOCTYPE html>
<html>
<body>
  <div class="product-card">
    <h2 class="product-name">Card 1</h2>
    <span class="price">29.00</span>
    <span class="size">L</span>
    <a href="/p/1">Ver</a>
  </div>
  <div class="product-card">
    <h2 class="product-name">Card 2</h2>
    <span class="product-price">39.50</span>
  </div>
</body>
</html>`;

export const HTML_NO_PRICE = `
<!DOCTYPE html>
<html>
<body>
  <h1>Sin precio</h1>
  <p>Solo nombre, no hay precio en la página.</p>
</body>
</html>`;
