import axios from 'axios';

// IPFS configuration from environment variables
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_API_SECRET = process.env.PINATA_API_SECRET;
const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
const IS_DEVELOPMENT = process.env.NEXT_PUBLIC_IS_DEVELOPMENT === 'true' || process.env.NODE_ENV === 'development';

/**
 * Upload data to IPFS via Pinata
 * @param {Object} data - The data object to upload
 * @returns {Promise<Object>} - Object with IPFS hash and gateway URL
 */
export const uploadToIPFS = async (data) => {
  if (IS_DEVELOPMENT && !PINATA_API_KEY) {
    console.warn('PINATA_API_KEY not configured. Using mock IPFS hash in development mode.');
    const mockHash = 'QmXzD3tfePtqsj6rHXz3jYYSNTp1duKHXjqGuA7XzR9u9N';
    return {
      ipfsHash: mockHash,
      ipfsUrl: `${IPFS_GATEWAY}${mockHash}`
    };
  }

  try {
    const jsonData = JSON.stringify(data);

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      jsonData,
      {
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_API_SECRET
        }
      }
    );

    const ipfsHash = response.data.IpfsHash;
    const ipfsUrl = `${IPFS_GATEWAY}${ipfsHash}`;

    return { ipfsHash, ipfsUrl };
  } catch (error) {
    console.error('Error uploading to IPFS:', error);
    if (IS_DEVELOPMENT) {
      // Return mock data for development
      const mockHash = 'QmXzD3tfePtqsj6rHXz3jYYSNTp1duKHXjqGuA7XzR9u9N';
      return {
        ipfsHash: mockHash,
        ipfsUrl: `${IPFS_GATEWAY}${mockHash}`
      };
    }
    throw error;
  }
};

/**
 * Upload a file to IPFS via Pinata
 * @param {File} file - The file to upload
 * @returns {Promise<Object>} - Object with IPFS hash and gateway URL
 */
export const uploadFileToIPFS = async (file) => {
  if (IS_DEVELOPMENT && !PINATA_API_KEY) {
    console.warn('PINATA_API_KEY not configured. Using mock IPFS hash in development mode.');
    const mockHash = 'QmddF3mqPVctH5TC4cLxkKq86ZfDBGc1NnpT9yzXCvmMbk';
    return {
      ipfsHash: mockHash,
      ipfsUrl: `${IPFS_GATEWAY}${mockHash}`
    };
  }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const metadata = JSON.stringify({
      name: file.name,
      keyvalues: {
        filename: file.name,
        contentType: file.type,
        timestamp: Date.now()
      }
    });
    formData.append('pinataMetadata', metadata);

    // Optional: set pinning options
    const pinataOptions = JSON.stringify({
      cidVersion: 0,
    });
    formData.append('pinataOptions', pinataOptions);

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        maxBodyLength: 'Infinity',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_API_SECRET
        }
      }
    );

    const ipfsHash = response.data.IpfsHash;
    const ipfsUrl = `${IPFS_GATEWAY}${ipfsHash}`;

    return { ipfsHash, ipfsUrl };
  } catch (error) {
    console.error('Error uploading file to IPFS:', error);
    if (IS_DEVELOPMENT) {
      // Return mock data for development
      const mockHash = 'QmddF3mqPVctH5TC4cLxkKq86ZfDBGc1NnpT9yzXCvmMbk';
      return {
        ipfsHash: mockHash,
        ipfsUrl: `${IPFS_GATEWAY}${mockHash}`
      };
    }
    throw error;
  }
};

/**
 * Get data from IPFS
 * @param {string} ipfsHash - The IPFS hash to fetch
 * @returns {Promise<Object>} - The data object
 */
export const getFromIPFS = async (ipfsHash) => {
  try {
    const response = await axios.get(`${IPFS_GATEWAY}${ipfsHash}`);
    return response.data;
  } catch (error) {
    console.error('Error fetching from IPFS:', error);
    if (IS_DEVELOPMENT) {
      // Return mock data for development
      return {
        fullName: 'John Doe',
        walletAddress: '0x0000000000000000000000000000000000000000',
        photoUrl: 'https://i.pravatar.cc/300',
        uniqueIDHash: '0x' + Array(64).fill(0).map(() =>
          Math.floor(Math.random() * 16).toString(16)).join(''),
        dateOfIssue: new Date().toISOString(),
        expirationDate: new Date(Date.now() + 31536000000).toISOString()
      };
    }
    throw error;
  }
};

/**
 * Alias for getFromIPFS for backward compatibility
 * @param {string} ipfsHash - The IPFS hash to fetch
 * @returns {Promise<Object>} - The data object
 */
export const fetchFromIPFS = getFromIPFS;
