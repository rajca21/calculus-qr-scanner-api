import https from 'https';

export const wsUrl =
  'https://skenirajfiskal.calculus.rs/CWSFiskaliQR/CalculusWebService.asmx';

// ## Header-i zahteva
export const contentType = 'text/xml; charset=utf-8';
export const getSoapAction = (methodName) => {
  return `"http://tempuri.org/${methodName}"`;
};

// ## HTTPS agent, omogućava slanje zahteva sa security protokolom
export const agent = new https.Agent({
  keepAlive: true,
  secureProtocol: 'TLSv1_2_method',
});
