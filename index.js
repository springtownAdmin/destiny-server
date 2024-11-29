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

// Webhook to check whether order is created or not
app.post('/webhooks/order-payment', (req, res) => {

    const receivedData = req.body;
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');  // HMAC signature for security validation

    // Validate webhook using Shopify's HMAC method
    const calculatedHmac = crypto
        .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
        .update(JSON.stringify(receivedData))
        .digest('base64');

    if (calculatedHmac === hmacHeader) {

        logger.info('=========================================>\n');
        logger.info('WEBHOOK_DATA_IS_VALID!\n');
        logger.info('=========================================>\n');
        logger.info(receivedData, '\n');
        logger.info('=========================================>\n');

        // Here you can calculate conversions or perform any tracking logic
        // For example, send the data to Google Analytics or your own analytics service


        // Send success response back to Shopify
        res.status(200).json({ message: 'Webhook received!' });

    } else {

        logger.info('=========================================>\n');
        logger.info('INVALID_WEBHOOK_DATA!\n');
        logger.info('=========================================>\n');
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

        logger.info('=========================================>\n');
        logger.info('STRIPE_PAYMENT_INTENT\n');
        logger.info('=========================================>\n');
        logger.info(paymentIntent, '\n');
        logger.info('=========================================>\n');

        // Send the client_secret to the client
        res.json({ clientSecret: paymentIntent.client_secret });


    } catch (error) {

        logger.info('=========================================>\n');
        logger.info('ERROR_WHILE_CREATING_STRIPE_PAYMENT_INTENT\n');
        logger.info('=========================================>\n');
        logger.error(error, '\n');
        logger.info('=========================================>\n');

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

    logger.info('=========================================>\n');
    logger.info('SHOPIFY_ORDER_PAYLOAD\n');
    logger.info('=========================================>\n');
    logger.info(shopifyOrderData, '\n');
    logger.info('=========================================>\n');

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

            logger.info('=========================================>\n');
            logger.info('ERROR_WHILE_CREATING_SHOPIFY_ORDER\n');
            logger.info('=========================================>\n');
            logger.error(response, '\n');
            logger.info('=========================================>\n');

            throw new Error(`Shopify order creation failed with status ${response.status}`);

        }

        const orderData = await response.json();

        logger.info('=========================================>\n');
        logger.info('SHOPIFY_ORDER_DATA\n');
        logger.info('=========================================>\n');
        logger.info(orderData, '\n');
        logger.info('=========================================>\n');

        res.status(200).json({
            message: "Shopify order created successfully",
            orderId: orderData.order.id,
            order: orderData.order,
        });

    } catch (error) {

        logger.info('=========================================>\n');
        logger.info('ERROR_WHILE_CREATING_SHOPIFY_ORDER\n');
        logger.info('=========================================>\n');
        logger.error(error, '\n');
        logger.info('=========================================>\n');
        res.status(500).json({ error: "Failed to create Shopify order" });

    }

});

app.post('/calculateShipping', (req, res) => {

    const { shippingAddress } = req.body;

    // Check if the country is supported
    if (shippingAddress.country !== 'US') {
        logger.info('=========================================>\n');
        logger.info('SHIPPING_ADDRESS_MUST_CONTAINS_(US)_ADDRESS\n');
        logger.info('=========================================>\n');
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

            logger.info('=====================================================>\n');
            logger.info('ERROR_WHILE_CALLING_STOREFRONT_API_FOR_ONE_PRODUCT\n');
            logger.info('=====================================================>\n');
            logger.error(response, '\n');
            logger.info('=====================================================>\n');

            throw new Error('Network response was not ok');

        }

        const data = await response.json();
        const originalData = data.data;

        logger.info('==================================================>\n');
        logger.info('STOREFRONT_API_RESPONSE_FOR_FETCHING_ONE_PRODUCT\n');
        logger.info('==================================================>\n');
        logger.info(data, '\n');
        logger.info('==================================================>\n');

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

        logger.info('=====================================================>\n');
        logger.info('ERROR_WHILE_FETCHING_ONE_PRODUCT\n');
        logger.info('=====================================================>\n');
        logger.error(error, '\n');
        logger.info('=====================================================>\n');

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

            logger.info('=====================================================>\n');
            logger.info('ERROR_WHILE_FETCHING_PRODUCTS\n');
            logger.info('=====================================================>\n');
            logger.info(response, '\n');
            logger.info('=====================================================>\n');

            throw new Error('Network response was not ok');

        }

        const data = await response.json();

        logger.info('=====================================================>\n');
        logger.info('RESPONSE_FROM_STOREFRONT_API_FOR_GETTING_PRODUCTS\n');
        logger.info('=====================================================>\n');
        logger.info(data, '\n');
        logger.info('=====================================================>\n');

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

        logger.info('=====================================================>\n');
        logger.info('ERROR_WHILE_FETCHING_PRODUCTS\n');
        logger.info('=====================================================>\n');
        logger.error(error, '\n');
        logger.info('=====================================================>\n');

        res.status(500).send('Error fetching products');

    }

});

// Endpoint to log on client-side code
app.post('/api/logs', (req, res) => {

    const { level, message, meta } = req.body;

    if (level === 'info') {
        siteLogger.info(message);
    } else if (level === 'error') {
        siteLogger.error(message);
    } else if (level === 'warn') {
        siteLogger.warn(message);
    }

    return res.status(200).json({ message: 'Log received' });

});

// Listening on port 8000
app.listen(8000, () => {

    logger.info('=====================================================>\n');
    logger.info('SERVER_RUNNING_INFO\n');
    logger.info('=====================================================>\n');
    logger.info(`${process.env.ENV === 'dev' ? process.env.DEV_URL : process.env.PROD_URL}`, '\n');
    logger.info('=====================================================>\n');

});