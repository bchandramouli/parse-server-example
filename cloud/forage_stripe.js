var Stripe = require('stripe')("sk_test_3n3xj9zbj6hOkEhngx7uITeH");

module.exports = function(app) {

/**
 * Endpoints and routes for Stripe pre-built UI in iOS to access. 
 *
 *  Expected input (in request.params):
 *   customerId : the stripe customer Id, duh!
 *  
 */
app.get('/stripe/customer', function(request, response) {
  var customerId = 'cus_A9H3lpT4fOK3ep'; // Get it from the request!
  Stripe.customers.retrieve(customerId, function(err, customer) {
    if (err) {
      response.status(402).send('Error retrieving customer.');
    } else {
      response.json(customer);
    }
  });
});

/* Stripe endpoint 2 */
app.get('/stripe/customer/sources', function(request, response) {
  var customerId = 'cus_A9H3lpT4fOK3ep'; // Load the Stripe Customer ID for your logged in user

  Stripe.customers.createSource(customerId, {
    source: request.body.source
  }, function(err, source) {
    if (err) {
      response.status(402).send('Error attaching source.');
    } else {
      response.status(200).end();
    }
  });
});

/* Stripe endpoint 3 */
app.get('/stripe/customer/default_source', function(request, response) {
  var customerId = 'cus_A9H3lpT4fOK3ep'; // Load the Stripe Customer ID for your logged in user

  Stripe.customers.update(customerId, {
    default_source: request.body.defaultSource
  }, function(err, customer) {
    if (err) {
      response.status(402).send('Error setting default source.');
    } else {
      response.status(200).end();
    }
  });
});
};
