# Use an official Apache HTTPD base image
FROM httpd:2.4

# Copy your web app content into the container
COPY ./ /usr/local/apache2/htdocs/

# Expose port 80 to the outside world
EXPOSE 80

# Default command to run Apache in the foreground
CMD ["httpd-foreground"]