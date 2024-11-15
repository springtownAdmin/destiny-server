require("dotenv").config({ path: "./.env" });
const express = require("express");
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser')
const { queryToFetchAvailableProducts, queryToFetchSingleProduct } = require('./graphql-queries');

app.use(cors());
app.use(bodyParser.json());

// Endpoint to fetch specific product details
app.get('/api/products/:id', async (req, res) => {

    const productId = req.params.id;

    const query = queryToFetchSingleProduct(productId);

    try {

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        }

        const response = await fetch(`https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`, options);

        console.log(`Fetching product from: https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`);

        if (!response.ok) {

            throw new Error('Network response was not ok');

        }

        const data = await response.json();
        const originalData = data.data;

        const formattedData = {
            product: {
                id: originalData.product.id,
                variant_id: originalData.product.variants.edges[0].node.id,
                title: originalData.product.title,
                description: originalData.product.description,
                images: originalData.product.images.edges.map(edge => edge.node.src),
                price: originalData.product.variants.edges[0].node.priceV2.amount,
                currency: originalData.product.variants.edges[0].node.priceV2.currencyCode
            }
        };

        res.json({ ...formattedData });  // Adjusting the response format to match what the client expects

    } catch (error) {

        console.error('Error fetching product:', error);
        res.status(500).send('Error fetching product');

    }

});

// Endpoint to fetch all the product details
app.get('/api/products', async (req, res) => {

    const query = queryToFetchAvailableProducts();

    try {

        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Storefront-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
            body: JSON.stringify({ query }),
        }

        const response = await fetch(`https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`, options);

        console.log(`Fetching products from: https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`);

        if (!response.ok) {

            throw new Error('Network response was not ok');

        }

        const data = await response.json();

        const products = data.data.products.edges.map(edge => ({
            id: edge.node.id,
            title: edge.node.title,
            available: edge.node.availableForSale
        })).filter(x => x.available);

        const pageInfo = data.data.products.pageInfo;

        // console.log(data.data.products.edges[0].node.variants.edges[0].node)

        // Respond with the data, focusing on products and pagination info if needed
        res.json({ products, pageInfo });

    } catch (error) {

        console.error('Error fetching products:', error);
        res.status(500).send('Error fetching products');

    }

});

// Listening on port 8000
app.listen(8000, () =>
    console.log(`Node server listening at http://localhost:8000`)
);