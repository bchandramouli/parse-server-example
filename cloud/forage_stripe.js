/**
 * Create a stripe customer for this home user!
 *
 *  Expected input (in request.params):
 *   email     : User's email
 *   homeId    : Associate the homeId as meta data on the customer!
 *  
 * We create a customer without a credit card (source) here!
 */
Parse.Cloud.define('createStripeCustomer', function(request, response) {

  var userEmail = request.params.userEmail;
  var homeId = request.params.homeId;

  var custDesc = 'Customer for ' + homeId;

  // Create a new Stripe customer!
  Stripe.customers.create({
        description: custDesc, // Add the homeId as meta data
        email: userEmail // Save the user's email
      }).then(function(customer) {
        // Save the Id!
        customerId = customer.id;

        // Send the customer Id back!
        response.success(customerId);

      }, function(error) {
        console.log(STRIPE_ERR_MOD, "error in creating stripe customer", error);
        response.error(error);
      });
});

/**
 * Endpoints and routes for Stripe pre-built UI in iOS to access. 
 *
 *  Expected input (in request.params):
 *   customerId : the stripe customer Id, duh!
 *  
 */
/* Serve Stripe endpoint 1 */
Parse.Cloud.define('getStripeCustomer', function(request, response) {

  var customerId = request.params.customerId;

  Stripe.customers.retrieve(customerId, function(error, customer) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error in getting customer's payment types", error);
      response.error('Error retrieving customer.');
    } else {

      // Send the customer JSON back!
      response.success(customer);
    }
  });
});

/* Serve Stripe endpoint 2 */
Parse.Cloud.define('setStripeCustomerSource', function(request, response) {

  var customerId = request.params.customerId;
  var cardId = request.params.cardId;

  Stripe.customers.createSource(customerId, {
    source: cardId
  }, function(error, source) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error adding a payment type to a customer", error);
      response.error('Error attaching source.');
    } else {
      response.success(SUCCESS_STR);
    }
  });
});

/* Serve Stripe endpoint 3 */
Parse.Cloud.define('updateStripeCustomerDefaultSource', function(request, response) {
  var customerId = request.params.customerId;
  var cardToken = request.params.cardToken;

  Stripe.customers.update(customerId, {
    default_source: cardToken
  }, function(error, customer) {
    if (error) {
      console.log(STRIPE_ERR_MOD, "error in getting customer's payment types", error);
      response.error('Error setting default source.');
    } else {
      response.success(SUCCESS_STR);
    }
  });
});
