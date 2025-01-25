import axios, { AxiosInstance } from "axios";

// Create an Axios instance
const axiosInstance: AxiosInstance = axios.create({
  baseURL: "http://localhost:3000", // Replace with your backend base URL
  timeout: 5000, // Timeout in milliseconds
});

// Function to dynamically set Authorization header
export function setAuthToken(token: string) {
  axiosInstance.defaults.headers.common["Authorization"] = `Bearer ${token}`;
}

export default axiosInstance;
