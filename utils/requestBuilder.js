// # Funkcija za formatiranje ulaznih parametara metode WS
const keysValuesBuilder = (keys, values) => {
  let keysValuesBody = '';
  keys.forEach((key, index) => {
    keysValuesBody += `<${key}>${values[index]}</${key}>\n`;
  });
  return keysValuesBody;
};

// # Funkcija za formatiranje okvira metode za telo metode WS
const methodWrapperBuilder = (method, keys = [], values = []) => {
  if (keys.length > 0) {
    return `<${method} xmlns="http://tempuri.org/">
          ${keysValuesBuilder(keys, values)}</${method}>`;
  } else {
    return `<${method} xmlns="http://tempuri.org/" />`;
  }
};

// ### Funkcija za formatiranje tela (body) metode WS
export const soapBodyBuilder = (method, keys = [], values = []) => {
  if (keys.length !== values.length) {
    return null;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
       ${methodWrapperBuilder(method, keys, values)}
      </soap:Body>
    </soap:Envelope>`;
};
