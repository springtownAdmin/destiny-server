require("dotenv").config({ path: "./.env" });
const express = require("express");
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser')
const { queryToFetchAvailableProducts, queryToFetchSingleProduct } = require('./graphql-queries');
const { logger, siteLogger } = require('./logger');
const crypto = require('crypto');

app.use(cors());
app.use(bodyParser.json());

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2022-08-01",
});

const GRAPHQL_STOREFRONT_API = `https://${process.env.SHOPIFY_DOMAIN}/api/2023-10/graphql.json`;
const GRAPHQL_ADMIN_API = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2023-10/orders.json`;
const GRAPHQL_ADMIN_ORDERS_API = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2023-10/orders`;

// Webhook to check whether order is created or not
app.post('/webhooks/order-payment', (req, res) => {

    const receivedData = req.body;
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');  // HMAC signature for security validation

    // Validate webhook using Shopify's HMAC method
    const calculatedHmac = crypto
        .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(receivedData)
        .digest('base64');


    // Log the raw received data and the stringified version
    console.log('Received Webhook Data:', req.body);
    console.log('Stringified Received Data:', receivedData);

    if (calculatedHmac === hmacHeader) {

        // Here you can calculate conversions or perform any tracking logic
        // For example, send the data to Google Analytics or your own analytics service


        // Send success response back to Shopify
        res.status(200).json({ message: 'Webhook received!' });

    } else {
        res.status(400).json({ message: 'Invalid request!' });

    }

});

app.post('/create-payment-intent', async (req, res) => {

    try {

        const { amount, currency, variantId, productTitles, quantity } = req.body;
        const amountInCents = Math.round(amount * 100);

        // Create a PaymentIntent with the specified amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents, // Amount in cents (e.g., $10.00 is 1000 cents)
            currency: currency, // e.g., 'usd'
            payment_method_types: ['card'], // Specify accepted payment methods
            metadata: {
                variant_id: variantId,
                productTitles: productTitles,
                quantity: quantity.toString(), // Stripe metadata requires values to be strings
            },
        });

        // Send the client_secret to the client
        res.json({ clientSecret: paymentIntent.client_secret });


    } catch (error) {
        // logger.error(error, '\n');

        res.status(500).json({ error: 'Failed to create PaymentIntent' });

    }

});

app.post("/create-shopify-order", async (req, res) => {

    const { variant_id, quantity, customerEmail, customerName, shippingAddress, billingAddress, event } = req.body;
    const variantId = variant_id.split("/").pop();

    // Construct the Shopify order payload
    const shopifyOrderData = {
        order: {
            line_items: [
                {
                    variant_id: variantId,
                    quantity: quantity
                },
            ],
            inventory_behaviour: "decrement_obeying_policy",
            customer: {
                first_name: customerName.split(" ")[0],
                last_name: customerName.split(" ")[1] || "",
                email: customerEmail,
            },
            shipping_address: {
                first_name: customerName.split(" ")[0],
                last_name: customerName.split(" ")[1] || "",
                address1: shippingAddress?.line1 || shippingAddress?.addressLine?.[0] || "N/A",
                address2: shippingAddress?.line2 || shippingAddress?.addressLine?.[1] || "",
                city: shippingAddress?.city || "N/A",
                province: shippingAddress?.region || "N/A",
                country: shippingAddress?.country || "N/A",
                zip: shippingAddress?.postalCode || "N/A",
            },
            billing_address: {
                first_name: billingAddress.name?.split(" ")[0] || customerName.split(" ")[0],
                last_name: billingAddress.name?.split(" ")[1] || customerName.split(" ")[1] || "",
                address1: billingAddress.line1 || billingAddress.addressLine?.[0] || "N/A",
                address2: billingAddress.line2 || billingAddress.addressLine?.[1] || "",
                city: billingAddress.city || "N/A",
                province: billingAddress.state || billingAddress.region || "N/A",
                country: billingAddress.country || "N/A",
                zip: billingAddress.postal_code || billingAddress.postalCode || "N/A",
            },
            financial_status: "paid",
        },
    };

    try {

        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
            },
            body: JSON.stringify(shopifyOrderData)
        }

        const response = await fetch(GRAPHQL_ADMIN_API, options);
        if (!response.ok) {

            logger.error(response);


            throw new Error(`Shopify order creation failed with status ${response.status}`);

        }

        const orderData = await response.json();

        res.status(200).json({
            message: "Shopify order created successfully",
            orderId: orderData.order.id,
            order: orderData.order,
        });

    } catch (error) {

        logger.error(error);
        res.status(500).json({ error: "Failed to create Shopify order" });

    }

});

app.post("/test-order", async (req, res) => {

    try {

        // Construct the Shopify order payload
        const shopifyOrderData = {
            order: {
                line_items: [
                    {
                        variant_id: 46075169931421,
                        quantity: 1
                    },
                ],
                inventory_behaviour: "decrement_obeying_policy",
                customer: {
                    first_name: "John",
                    last_name: "Doe",
                    email: "johndoe@gmail.com",
                },
                shipping_address: {
                    first_name: "John",
                    last_name: "Doe",
                    address1: "104 Washington Place",
                    address2: "Apt 3",
                    city: "New York",
                    province: "NY",
                    country: "US",
                    zip: "10014",
                },
                billing_address: {
                    first_name: "John",
                    last_name: "Doe",
                    address1: "116 Buccaneer St",
                    address2: "A",
                    city: "Marina De La Rey",
                    province: "CA",
                    country: "US",
                    zip: "90292",
                },
                financial_status: "paid",
            },
        };

        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
            },
            body: JSON.stringify(shopifyOrderData)
        }

        const response = await fetch(GRAPHQL_ADMIN_API, options);

        if (!response.ok) {
            // logger.error(response);


            throw new Error(`Shopify order creation failed with status ${response.status}`);

        }

        const orderData = await response.json();


        res.status(200).json({
            message: "Shopify order created successfully",
            orderId: orderData.order.id,
            order: orderData.order,
        });


    } catch (e) {
        logger.error(error);

        res.status(500).json({ error: "Failed to create Shopify order" });

    }

});

app.post('/calculateShipping', (req, res) => {

    const { shippingAddress } = req.body;

    // Check if the country is supported
    if (shippingAddress.country !== 'US') {
        return res.status(400).json({ status: 'invalid_shipping_address' });
    }

    // Define example shipping options
    const shippingOptions = [
        {
            id: 'standard',
            label: 'Standard Shipping (5-7 business days)',
            amount: 0,  // Amount in cents
            description: 'Standard shipping rate'
        },
        {
            id: 'express',
            label: 'Express Shipping (2-3 business days)',
            amount: 2000, // Amount in cents
            description: 'Express shipping rate'
        }
    ];

    // Send the supported shipping options back to the client
    res.json({ supportedShippingOptions: shippingOptions });

});

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

        const response = await fetch(GRAPHQL_STOREFRONT_API, options);

        if (!response.ok) {
            logger.error(response, '\n');

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

        logger.error(error, '\n');

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

        const response = await fetch(GRAPHQL_STOREFRONT_API, options);

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

        // logger.error(error, '\n');


        res.status(500).send('Error fetching products');

    }

});

// Endpoint to log on client-side code
app.post('/api/logs', (req, res) => {

    const { level, message, meta } = req.body;

    // if (level === 'info') {
    //     siteLogger.info(message);
    // } else if (level === 'error') {
    //     siteLogger.error(message);
    // } else if (level === 'warn') {
    //     siteLogger.warn(message);
    // }

    return res.status(200).json({ message: 'Log received' });

});

// Listening on port 8000
app.listen(8000, () => {
    console.log('server is running on port 8000');
    

});